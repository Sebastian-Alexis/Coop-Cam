//utility functions for creating test data

//mock MJPEG frame data
export const createMockJpegFrame = () => {
  //minimal valid JPEG structure
  const jpegStart = Buffer.from([0xFF, 0xD8]) //SOI marker
  const jpegEnd = Buffer.from([0xFF, 0xD9])   //EOI marker
  const fakeData = Buffer.from('fake jpeg data')
  return Buffer.concat([jpegStart, fakeData, jpegEnd])
}

//create multiple frames for stream testing
export const createMockJpegStream = (frameCount = 2) => {
  const frames = []
    // TEMP_DELETE_2373: 6 lines removed
//create mock HTML response for DroidCam busy state
export const createBusyHtml = (message = 'DroidCam is Busy') => {
  return `<html><body>${message}</body></html>`
}
//create mock HTML response for DroidCam busy state
export const createBusyHtml = (message = 'DroidCam is Busy') => {
  return `<html><body>${message}</body></html>`
}
