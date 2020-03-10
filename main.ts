import fs from 'fs'
import { spawn } from 'child_process'
import { app } from 'electron'
import chokidar from 'chokidar'

const appPath = app.getAppPath()
const ignoredPaths = /node_modules|[/\\]\./
// Main file poses a special case, as its changes are
// only effective when the process is restarted (hard reset)
// We assume that electron-reload is required by the main
// file of the electron application
// const mainFile = module.parent.filename;

/**
 * Creates a callback for hard resets.
 *
 * @param {String} eXecutable path to electron executable
 * @param {String} hardResetMethod method to restart electron
 */
const createHardresetHandler = (
  eXecutable: string,
  hardResetMethod?: string,
  argv?: string[]
) => () => {
  // Detaching child is useful when in Windows to let child
  // live after the parent is killed
  const args = (argv ?? []).concat([appPath])
  const child = spawn(eXecutable, args, {
    detached: true,
    stdio: 'inherit'
  })
  child.unref()
  // Kamikaze!

  // In cases where an app overrides the default closing or quiting actions
  // firing an `app.quit()` may not actually quit the app. In these cases
  // you can use `app.exit()` to gracefully close the app.
  if (hardResetMethod === 'exit') {
    app.exit()
  } else {
    app.quit()
  }
}

export default (
  glob: string | string[],
  options: Partial<
  chokidar.WatchOptions & {
    hardResetMethod?: string
    argv?: typeof process['argv']
    forceHardReset?: boolean
    electron?: string
    mainFile?: string
  }
  > = {}
): void => {
  const mainFile = options.mainFile ?? module.parent?.filename ?? ''
  const browserWindows: Electron.BrowserWindow[] = []
  const watcher = chokidar.watch(
    glob,
    Object.assign({ ignored: [ignoredPaths, mainFile] }, options)
  )

  // Callback function to be executed:
  // I) soft reset: reload browser windows
  const softResetHandler = (): void =>
    browserWindows.forEach(bw => bw.webContents.reloadIgnoringCache())
  // II) hard reset: restart the whole electron process
  const eXecutable = options.electron
  const hardResetHandler = createHardresetHandler(
    eXecutable ?? '',
    options.hardResetMethod,
    options.argv
  )

  // Add each created BrowserWindow to list of maintained items
  app.on('browser-window-created', (_e, bw) => {
    browserWindows.push(bw)

    // Remove closed windows from list of maintained items
    bw.on('closed', function () {
      const i = browserWindows.indexOf(bw) // Must use current index
      browserWindows.splice(i, 1)
    })
  })

  // Enable default soft reset
  watcher.on('change', softResetHandler)

  // Preparing hard reset if electron executable is given in options
  // A hard reset is only done when the main file has changed
  if (typeof eXecutable === 'string' && fs.existsSync(eXecutable)) {
    const hardWatcher = chokidar.watch(
      mainFile,
      Object.assign({ ignored: [ignoredPaths] }, options)
    )

    if (options.forceHardReset === true) {
      // Watch every file for hard reset and not only the main file
      hardWatcher.add(glob)
      // Stop our default soft reset
      watcher.close()
    }

    hardWatcher.once('change', hardResetHandler)
  } else {
    console.log('Electron could not be found. No hard resets for you!')
  }
}
