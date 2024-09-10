import axios from "axios"
import StreamSlicer from "./StreamSlicer";

// initializing axios
const api = axios.create({
  baseURL: "/",
})

// original source: https://github.com/pilovm/multithreaded-uploader/blob/master/frontend/uploader.js
export class Uploader {
  constructor(options) {
    this.compressData = options.compressData
    // this must be bigger than or equal to 5MB,
    // otherwise AWS will respond with:
    // "Your proposed upload is smaller than the minimum allowed size"
    options.chunkSize = options.chunkSize || 0
    this.chunkSize = Math.max((1024 * 1024 * options.chunkSize), (1024 * 1024 * 5))
    // number of parallel uploads
    options.threadsQuantity = options.threadsQuantity || 0
    this.threadsQuantity = Math.min(options.threadsQuantity || 5, 15)
    // adjust the timeout value to activate exponential backoff retry strategy
    this.timeout = 0
    this.file = options.file
    this.fileName = options.fileName
    this.aborted = false
    this.uploadedSize = 0
    this.progressCache = {}
    this.activeConnections = {}
    this.parts = []
    this.uploadedParts = []
    this.partCount = -1
    this.lastPartNumber = -1
    this.fileId = null
    this.fileKey = null
    this.onProgressFn = () => {}
    this.onErrorFn = () => {}
    this.baseURL = options.baseURL

    let stream = this.file.stream();
    if (this.compressData) {
      // Get CompressionStream from the window object so that React doesn't complain that it doesn't exist
      // See https://stackoverflow.com/q/75754724/33905
      stream = stream.pipeThrough(new window.CompressionStream('gzip'));
    }
    this.reader = stream
        .pipeThrough(new TransformStream(new StreamSlicer(this.chunkSize)))
        .getReader();
  }

  async start() {
    await this.initialize()
  }

  async initialize() {
    try {
      // adding the file extension (if present) to fileName
      let fileName = this.file.name

      // initializing the multipart request
      const videoInitializationUploadInput = {
        name: fileName,
        compressData: this.compressData
      }
      const initializeReponse = await api.request({
        url: "/initialize",
        method: "POST",
        data: videoInitializationUploadInput,
        baseURL:this.baseURL
      })

      const AWSFileDataOutput = initializeReponse.data

      this.fileId = AWSFileDataOutput.fileId
      this.fileKey = AWSFileDataOutput.fileKey

      // retrieving the pre-signed URLs
      // Get an extra part, just in case the compressed file is a little bigger than the original for some reason!
      const numberOfparts = Math.ceil(this.file.size / this.chunkSize) + 1

      const AWSMultipartFileDataInput = {
        fileId: this.fileId,
        fileKey: this.fileKey,
        parts: numberOfparts,
      }

      const urlsResponse = await api.request({
        url: "/getPreSignedUrls",
        method: "POST",
        data: AWSMultipartFileDataInput,
        baseURL:this.baseURL
      })

      const newParts = urlsResponse.data.parts
      this.parts.push(...newParts)

      await this.sendNext()
    } catch (error) {
      await this.complete(error)
    }
  }

  async sendNext(retry = 0) {
    const activeConnections = Object.keys(this.activeConnections).length

    if (activeConnections >= this.threadsQuantity) {
      return
    }

    if (!this.parts.length) {
      if (!activeConnections) {
        await this.complete()
      }

      return
    }

    // Need to send the parts in order, since we are reading the stream - use shift() rather than pop()
    const part = this.parts.shift()
    if (this.file) {
      const result = await this.reader.read();
      if (!part || result.done) {
        console.log(`done: ${result.done}`);
        // We're done - we don't need any of the remaining parts
        this.parts = [];
        this.partCount = this.lastPartNumber;
        return;
      }
      this.lastPartNumber = part.PartNumber;
      const chunk = result.value;
      console.log(`Chunk # ${part.PartNumber}, size: ${chunk?.byteLength}, done: ${result.done}`);

      const sendChunkStarted = () => {
        this.sendNext()
      }

      this.sendChunk(chunk, part, sendChunkStarted)
          .then(() => {
            this.sendNext();
          })
          .catch((error) => {
            if (retry <= 6) {
              retry++
              const wait = (ms) => new Promise((res) => setTimeout(res, ms));
              //exponential backoff retry before giving up
              console.log(`Part#${part.PartNumber} failed to upload, backing off ${2 ** retry * 100} before retrying...`)
              wait(2 ** retry * 100).then(() => {
                this.parts.push(part)
                this.sendNext(retry)
              })
            } else {
              console.log(`Part#${part.PartNumber} failed to upload, giving up`)
              this.complete(error)
            }
          })
    }
  }

  async complete(error) {
    if (error && !this.aborted) {
      this.onErrorFn(error)
      return
    }

    if (error) {
      this.onErrorFn(error)
      return
    }

    try {
      await this.sendCompleteRequest()
    } catch (error) {
      this.onErrorFn(error)
    }
  }

  async sendCompleteRequest() {
    if (this.fileId && this.fileKey) {
      const videoFinalizationMultiPartInput = {
        fileId: this.fileId,
        fileKey: this.fileKey,
        parts: this.uploadedParts,
      }

      await api.request({
        url: "/finalize",
        method: "POST",
        data: videoFinalizationMultiPartInput,
        baseURL:this.baseURL
      })

      // For reasons unknown, the front end app wants to see 100% twice!
      this.onProgressFn({
        sent: this.uploadedSize,
        total: this.file.size,
        percentage: 100,
      })
      this.onProgressFn({
        sent: this.uploadedSize,
        total: this.file.size,
        percentage: 100,
      })
    }
  }

  sendChunk(chunk, part, sendChunkStarted) {
    return new Promise((resolve, reject) => {
      this.upload(chunk, part, sendChunkStarted)
        .then((status) => {
          if (status !== 200) {
            reject(new Error("Failed chunk upload"))
            return
          }

          resolve()
        })
        .catch((error) => {
          reject(error)
        })
    })
  }

  handleProgress(part, event) {
    if (this.file) {
      if (event.type === "progress" || event.type === "error" || event.type === "abort") {
        this.progressCache[part] = event.loaded
      }

      if (event.type === "loadend") {
        this.uploadedSize += this.progressCache[part] || 0
        delete this.progressCache[part]
      }

      const inProgress = Object.keys(this.progressCache)
        .map(Number)
        .reduce((memo, id) => (memo += this.progressCache[id]), 0)

      const sent = Math.min(this.uploadedSize + inProgress, this.file.size)

      const total = this.file.size

      const percentage = Math.round((sent / total) * 100)

      this.onProgressFn({
        sent: sent,
        total: total,
        percentage: percentage,
      })
    }
  }

  upload(file, part, sendChunkStarted) {
    // uploading each part with its pre-signed URL
    return new Promise((resolve, reject) => {
      const throwXHRError = (error, part, abortFx) => {
        delete this.activeConnections[part.PartNumber - 1]
        reject(error)
        window.removeEventListener('offline', abortFx)
      }
      if (this.fileId && this.fileKey) {
        if(!window.navigator.onLine)
          reject(new Error("System is offline"))

        const xhr = (this.activeConnections[part.PartNumber - 1] = new XMLHttpRequest())
        xhr.timeout = this.timeout
        sendChunkStarted()

        const progressListener = this.handleProgress.bind(this, part.PartNumber - 1)

        xhr.upload.addEventListener("progress", progressListener)

        xhr.addEventListener("error", progressListener)
        xhr.addEventListener("abort", progressListener)
        xhr.addEventListener("loadend", progressListener)

        xhr.open("PUT", part.signedUrl)
        const abortXHR = () => xhr.abort()
        xhr.onreadystatechange = () => {
          if (xhr.readyState === 4 && xhr.status === 200) {
            const ETag = xhr.getResponseHeader("ETag")

            if (ETag) {
              const uploadedPart = {
                PartNumber: part.PartNumber,
                ETag: ETag.replaceAll('"', ""),
              }

              this.uploadedParts.push(uploadedPart)

              resolve(xhr.status)
              delete this.activeConnections[part.PartNumber - 1]
              window.removeEventListener('offline', abortXHR)
            }
          }
        }

        xhr.onerror = (error) => {
          throwXHRError(error, part, abortXHR)
        }
        xhr.ontimeout = (error) => {
          throwXHRError(error, part, abortXHR)
        }
        xhr.onabort = () => {
          throwXHRError(new Error("Upload canceled by user or system"), part)
        }
        window.addEventListener('offline', abortXHR);
        xhr.send(file)
      }
    })
  }



  onProgress(onProgress) {
    this.onProgressFn = onProgress
    return this
  }

  onError(onError) {
    this.onErrorFn = onError
    return this
  }

  abort() {
    Object.keys(this.activeConnections)
      .map(Number)
      .forEach((id) => {
        this.activeConnections[id].abort()
      })

    this.aborted = true
  }
}
