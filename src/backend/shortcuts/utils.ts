import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'graceful-fs'
import { GameInfo } from 'common/types'
import { basename, dirname, extname, join } from 'path'
import { downloadFile } from 'backend/utils'
import { createAbortController } from 'backend/utils/aborthandler/aborthandler'
import { heroicIconFolder as iconsFolder } from 'backend/constants/paths'

function createImage(
  buffer: Buffer,
  outputFilePath: string
): string | undefined {
  try {
    writeFileSync(outputFilePath, buffer, {
      encoding: 'ascii'
    })
  } catch (error) {
    return `${error}`
  }
  return
}

function downloadImage(
  imageURL: string,
  outputFilePath: string
): string | undefined {
  try {
    downloadFile({
      url: imageURL,
      dest: outputFilePath,
      abortSignal: createAbortController(imageURL).signal
    })
  } catch (error) {
    return `Donwloading of ${imageURL} failed with:\n${error}`
  }
  return
}

function removeImage(imagePath: string): string | undefined {
  try {
    unlinkSync(imagePath)
  } catch (error) {
    return `Removing of ${imagePath} failed with:\n${error}`
  }
  return
}

function checkImageExistsAlready(image: string): boolean {
  const extentions = ['.png', '.jpg']

  const imageName = basename(image).replace(extname(image), '')
  const dirName = dirname(image)

  const found = extentions.find((extention) => {
    return existsSync(join(dirName, imageName + extention))
  })

  return found !== undefined ? true : false
}

async function getIcon(appName: string, gameInfo: GameInfo) {
  if (!existsSync(iconsFolder)) {
    mkdirSync(iconsFolder)
  }

  // By default use vertical image - art_square in jpg format
  const image = gameInfo.art_square
    .replaceAll(' ', '%20')
    .replace('{ext}', 'jpg')
  const icon = `${iconsFolder}/${appName}.jpg`

  if (!checkImageExistsAlready(icon)) {
    downloadImage(image, icon)
  }
  return icon
}

export {
  createImage,
  downloadImage,
  removeImage,
  checkImageExistsAlready,
  getIcon
}
