export function imageLayout(width: number, height: number, viewportWidth: number, viewportHeight: number, zoom: number, rotation: number) {
  const sideways = rotation % 180 !== 0
  const rotatedWidth = sideways ? height : width
  const rotatedHeight = sideways ? width : height
  const fit = Math.min(1, Math.max(1, viewportWidth - 32) / rotatedWidth, Math.max(1, viewportHeight - 32) / rotatedHeight)
  const scale = fit * zoom
  return {width: width * scale, height: height * scale, boundsWidth: rotatedWidth * scale, boundsHeight: rotatedHeight * scale}
}

export function clampImagePan(x: number, y: number, boundsWidth: number, boundsHeight: number, viewportWidth: number, viewportHeight: number) {
  const horizontal = Math.max(0, (boundsWidth - viewportWidth) / 2)
  const vertical = Math.max(0, (boundsHeight - viewportHeight) / 2)
  return {x: Math.max(-horizontal, Math.min(horizontal, x)), y: Math.max(-vertical, Math.min(vertical, y))}
}
