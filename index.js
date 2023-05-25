'use strict'


/**
 * Modules (Node.js)
 * @constant
 */
const fs = require('fs')
const makeDir = require('make-dir')
const os = require('os')
const path = require('path')
const util = require('util')

/**
 * Modules (Third party)
 * @constant
 */
const _ = require('lodash')
const Appdirectory = require('appdirectory')
const chalk = require('chalk')
const { GetElectronProcessType } = require('electron-process-type/lib/v3')
const isDebug = require('@sidneys/is-env')('debug')
const isNolog = require('@sidneys/is-env')('nolog')
const moment = require('moment')
const present = require('present')
const readPkgUp = require('read-pkg-up')
const rootPath = require('root-path')


/**
 * Look up filesystem location & Package info
 * of Logger module & Top-level ('root') module
 */
const loggerPackagePath = __filename
const loggerPackageJson = readPkgUp.sync({ cwd: loggerPackagePath })?.packageJson || {}
const rootPackagePath = rootPath()
const rootPackageJson = readPkgUp.sync({ cwd: rootPackagePath })?.packageJson || {}


/**
 * Set filename and location of log file
 */
const logfileLabel = rootPackageJson.productName || rootPackageJson.name
const logfilePath = path.join((new Appdirectory(logfileLabel)).userLogs(), `${logfileLabel}.log`)


/**
 * Requiring Package
 * Decision algorithms for evaluating the module which has required / loaded this package
 *
 * Type LOCAL: within the top-level module path, required via filename, e.g. require('src/app.js')
 * Type THIRD PARTY: external, required via module name, e.g. require('lodash')
 */
const requiringPackage = {
    rootPackagePath: rootPackagePath,
    get path() {
        // noinspection JSDeprecatedSymbols
        return module.parent && module.parent.filename ? module.parent.filename : module.filename
    },
    get filename() {
        return path.basename(this.path)
    },
    get directory() {
        return path.dirname(readPkgUp.sync({ cwd: this.path }).path)
    },
    get name() {
        return readPkgUp.sync({ cwd: this.path }).packageJson.name
    },
    get isLocalModule() {
        // Compare root directories of top-level module and requiring module.
        // If requiring modules' base directory is NOT identical to root modules'
        // base directory, the requiring module is a THIRD-PARTY Module.
        return (this.directory === this.rootPackagePath)
    }
}

/**
 * Default Options for Logger Instance
 * @type {LoggerConfiguration}
 * @default
 */
const defaultLoggerOptions = {
    write: false,
    timestamp: false,
    namespace: requiringPackage.name,
    logfile: logfilePath
}

/**
 * Initialize Globals
 * Immediately invoked
 */
let initializeGlobals
// eslint-disable-next-line no-unused-vars
(initializeGlobals = () => {
    // Check if 'global[@sidneys/logger]' exists
    if (global.hasOwnProperty(loggerPackageJson.name)) {
        return
    }
    // Create object at key 'global[@sidneys/logger]'
    global[loggerPackageJson.name] = {}
    global[loggerPackageJson.name].configurations = new Map()
})()


/**
 * @typedef {function} LogMethod
 * @param {...*} Log message
 */

/**
 * @typedef {Object} LoggerInstance
 *
 * @property {LogMethod} debug
 * @property {LogMethod} log
 * @property {LogMethod} info
 * @property {LogMethod} warn
 * @property {LogMethod} error
 * @property {LogMethod} fatal
 * @property {function} format
 * @property {LoggerConfiguration} configuration
 */

/**
 * @typedef {object} LoggerConfiguration
 *
 * @property {boolean} write
 * @property {boolean} timestamp
 * @property {string} namespace
 * @property {string} logfile
 */

/**
 * @typedef {function} LoggerFactory
 */

/**
 * Log message level
 * debug, information, normal, warning, error, fatal
 * @readonly
 * @enum {string}
 */
const LogMessageLevel = {
    Debug: 'debug',
    Information: 'information',
    Normal: 'normal',
    Warning: 'warning',
    Error: 'error',
    Fatal: 'fatal'
}

/**
 * Log message target medium / environment
 * Browser Console, Terminal, File
 * @readonly
 * @enum {string}
 */
const LogMessageMedium = {
    Browser: 'browser',
    Terminal: 'terminal',
    File: 'file'
}

/**
 * Application Context - Where a script is running
 * Nodejs, Electron
 * @readonly
 * @enum {string}
 */
const AppContext = {
    Nodejs: 'nodejs',
    Electron: 'electron'
}

const currentAppContext = (GetElectronProcessType() === 'browser') ? AppContext.Electron : AppContext.Nodejs
const isElectronContext = Boolean(currentAppContext === AppContext.Electron)

/**
 * A formatted log message
 * @typedef {string} LogMessageFormatted
 */

/**
 * @typedef {Object} LogMessageStyle
 *
 * @property {string} icon - Unicode character (emoji) of log level
 * @property {string} colorName - Color name (CSS) of log level
 * @property {number[]} colorRgb - Color code (RGB) of log level
 */

/**
 * Log Styles
 * @type {Object.<LogMessageLevel, LogMessageStyle>}
 * @constant
 */
const LogStyleDictionary = {
    [LogMessageLevel.Debug]: {
        icon: '🔧',
        colorName: 'cyan',
        colorRgb: [ 100, 100, 100 ]
    },
    [LogMessageLevel.Normal]: {
        icon: '📝',
        colorName: 'cyan',
        colorRgb: [ 0, 128, 255 ]
    },
    [LogMessageLevel.Information]: {
        icon: 'ℹ️ ',
        colorName: 'magenta',
        colorRgb: [ 255, 100, 150 ]
    },
    [LogMessageLevel.Warning]: {
        icon: '⚠️ ',
        colorName: 'yellow',
        colorRgb: [ 200, 100, 30 ]
    },
    [LogMessageLevel.Error]: {
        icon: '🚨',
        colorName: 'red',
        colorRgb: [ 230, 70, 50 ]
    },
    [LogMessageLevel.Fatal]: {
        icon: '🔥',
        colorName: 'bgRed',
        colorRgb: [ 255, 60, 0 ]
    }
}


/**
 * Exported Logger Instance
 * @type {LoggerInstance|LoggerFactory}
 * @global
 */
let loggerInstanceOrFactory


/**
 * Get Timestamp for Logfile
 * @returns {String} - Timestamp
 * @private
 */
let getCurrentTimestamp = () => moment().format('YYYY-DD-MM HH:mm:ss')

/**
 * Initial Log Timestamp
 * @returns {String} - Timestamp
 * @private
 */
let initialTimestamp = null

/**
 * Append Message to Logfile
 * @param {String=} message - Log Message
 * @private
 */
let writeLogMessageToFile = (message = '') => {
    // console.warn('appendMessageToFile', 'message', message)

    // Get this Logger instances' configuration
    const configuration = loggerInstanceOrFactory.configuration
    const logfile = configuration.logfile

    // Test if it should write to file
    if (!configuration.write || isNolog) { return }

    // Ensure Log Directory exists
    makeDir(path.dirname(logfile))
        .then(() => {
            // Create Stream
            const stream = fs.createWriteStream(logfile, { flags: 'a' })

            // Split message into lines
            message.split(os.EOL).forEach((line) => {
                // Write to stream
                stream.write(`[${getCurrentTimestamp()}] ${line}${os.EOL}`)
            })

            // Close Stream
            stream.end()
        })
        .catch((error) => {
            console.error('logger', 'appendMessageToFile', 'fs.mkdirp', error)
        })
}

/**
 * Append Header to Logfile
 * @private
 */
let writeLogfileHeader = () => {
    writeLogMessageToFile(`${os.EOL}LOG STARTED (${getCurrentTimestamp()})${os.EOL}${'▔'.repeat(80)}`)
}


/**
 * Create a formatted Log Message
 * @class LogMessage
 *
 * @property {LogMessageMedium} medium
 * @property {LogMessageLevel} level
 * @property {LogMessageStyle.icon} icon
 * @property {LogMessageStyle.colorRgb} colorRgb
 * @property {LogMessageStyle.colorName} colorName
 * @property {chalk.Chalk} chalkStyle - Chalk Style
 *
 * @property {string} title -  Title of Log Message
 * @property {string} body - Body of Log Message
 * @property {number} timestamp - Timestamp of Log Message
 *
 * @property {number} thread - Log Thread
 * @property {string} namespace - Log Namespace
 */
class LogMessage {
    /**
     * @param {LogMessageMedium} medium - Log medium
     * @param {LogMessageLevel} level - Log level
     * @param {any[]} message - Log message
     */
    constructor(medium, level, message) {
        // console.warn('constructor')

        /** Assign  */
        this.medium = medium
        this.level = level

        /** Style  */
        const style = LogStyleDictionary[level]

        this.icon = style.icon
        this.colorRgb = style.colorRgb
        this.colorName = style.colorName
        this.chalkStyle = chalk[this.colorName]

        /**
         * Namespace
         * – get this Logger instances' configuration from <global>
         * – get other Logger' instances' configurations from <global>
         */
        const configuration = loggerInstanceOrFactory.configuration
        this.namespace = configuration.namespace

        const allConfigurations = Array.from(global[loggerPackageJson.name].configurations.values())
        const namespacesList = _.map(allConfigurations, 'namespace')

        /**
         * Message Threads
         * – deriving a 'thread': consecutive messages within same namespace
         * – enables alternating logs when namespaces change
         */
        const namespaceIndex = namespacesList.indexOf(this.namespace)
        this.thread = namespaceIndex & 1

        const indent = (this.medium !== LogMessageMedium.Browser) ? (`i [${this.namespace}] `).length : (`i  [${this.namespace}]  `).length

        /**
         * Title & Body
         */
        // Formatting & massage JavaScript entities for log string output
        for (let index in message) {
            if (message.hasOwnProperty(index)) {
                if (_.isObjectLike(message[index])) {
                    if (_.isArray(message[index])) {
                        message[index]
                            = os.EOL + ' '.repeat(indent) + '[' + os.EOL + ' '.repeat(indent + 2) + message[index].join(',' + os.EOL + ' '.repeat(indent + 2)) + os.EOL + ' '.repeat(indent) + ']'
                    } else {
                        message[index] = os.EOL + util.inspect(message[index], {
                            depth: null, showProxy: true, showHidden: true
                        })
                        message[index] = message[index].replace(new RegExp(os.EOL, 'gi'), `${os.EOL}${' '.repeat(indent)}`)
                    }

                    message[index - 1] = `${message[index - 1]}`
                }
            }
        }

        // If there are more than 1 segments to the message, use the first as the message "title"
        if (message.length > 1) {
            this.title = message[0]
            message.shift()
        }

        // Concatenate the rest of the message
        this.body = message.join(' ')

        // if there's no title, remove body
        if (!this.title) { this.title = this.body }

        // consolidate title, body
        if (this.title === this.body) { this.body = '' }

        /**
         * Timestamp
         */
        if (configuration.timestamp) {
            if (!initialTimestamp) { initialTimestamp = present() }
            this.timestamp = `${(present() - initialTimestamp).toFixed(4)} ms`
            initialTimestamp = present()
        } else {
            this.timestamp = ''
        }
    }
}

/**
 * Format log messages
 * @param {LogMessageMedium} targetMedium - Target medium
 * @param {LogMessageLevel} targetLevel - Target level
 * @param {any[]} args - Log message arguments
 * @returns {LogMessageFormatted}
 *
 * @private
 */
let formatLogMessage = (targetMedium = LogMessageMedium.Terminal, targetLevel, args) => {
    // Instantiate a LogMessage
    const message = new LogMessage(targetMedium, targetLevel, args)

    let formattedMessage

    switch (targetMedium) {
        case LogMessageMedium.Terminal:
            //const chalkStyleColor = chalk.keyword(message.colorName)
            const chalkStyleColor = message.chalkStyle
            formattedMessage = [
                message.icon,
                message.thread ? chalkStyleColor(message.namespace) : chalkStyleColor.underline(message.namespace),
                '|',
                message.title && chalkStyleColor.bold(message.title),
                message.body && chalkStyleColor(message.body),
                message.timestamp && message.timestamp
            ]

            formattedMessage = formattedMessage.filter(Boolean).join(' ').trim()

            break
        case LogMessageMedium.Browser:
            const color = message.colorRgb.join(' ')

            formattedMessage = [
                `%s %c %s | %c %c%s%c %c%s%c %s`,
                message.icon,
                `background-color: rgb(${color} / 0.2); color: rgb(${color} / 0.8); padding: 0 0px; font-weight: normal`,
                message.namespace,
                message.title && '',
                message.title && `background-color: rgb(${color} / 0.0); color: rgb(${color} / 1.0); padding: 0 0px; font-weight: bold`,
                message.title && message.title,
                message.body && '',
                message.body && `background-color: rgb(${color} / 0.1); color: rgb(${color} / 1.0); padding: 0 0px; font-weight: normal`,
                message.body && message.body,
                message.timestamp && `background-color: rgb(${color} / 0.0); color: rgb(${color} / 0.5); padding: 0 0px; font-weight: normal`,
                message.timestamp && message.timestamp
            ]

            break
        case LogMessageMedium.File:
            formattedMessage = [
                message.level.toUpperCase(),
                _.startCase(targetMedium),
                '|',
                message.namespace,
                message.title && message.title,
                message.body && message.body
            ]

            formattedMessage = formattedMessage.filter(Boolean).join(' ').trim()
    }

    return formattedMessage
}

/**
 * Main logging function
 * @param {LogMessageLevel} level - Log level
 * @param {any[]} args - Log message arguments
 *
 * @private
 */
let log = function(level = LogMessageLevel.Normal, ...args) {
    if (args.length === 0) { return }

    // Skip debug logging if log level higher
    if ((level === LogMessageLevel.Debug) && !!!isDebug) { return }

    // Select target for log message (Developer Console, Nodejs Terminal)
    const targetMedium = isElectronContext ? LogMessageMedium.Browser : LogMessageMedium.Terminal

    // Format log message
    const formattedMessage = formatLogMessage(targetMedium, level, args)

    // Display log message
    console.log(formattedMessage)

    // Write log message to file
    writeLogMessageToFile(formatLogMessage(LogMessageMedium.File, level, args))
}

/**
 * Main logging function, bound context-aware at require-time
 * @type {function}
 *
 * @private
 */
let contextLog = log.bind(isElectronContext ? window.console : this)

/**
 * Populate Logger Instance
 * @type {LoggerInstance}
 */
const defaultLoggerObject = {
    debug: contextLog.bind(this, LogMessageLevel.Debug),
    log: contextLog.bind(this, LogMessageLevel.Normal),
    info: contextLog.bind(this, LogMessageLevel.Information),
    warn: contextLog.bind(this, LogMessageLevel.Warning),
    error: contextLog.bind(this, LogMessageLevel.Error),
    fatal: contextLog.bind(this, LogMessageLevel.Fatal),

    format: (level, ...args) => formatLogMessage(LogMessageMedium.Terminal, level, args),

    configuration: defaultLoggerOptions
}


/**
 * Create Logger instance
 * @param {LoggerConfiguration} options - Options
 * @returns {LoggerInstance|LoggerFactory}
 */
let createLoggerInstance = function(options = {}) {

    // Merge in default options
    const configuration = _.defaultsDeep(options, defaultLoggerOptions)

    /**
     * Get root (origin) module data
     */
    const rootModuleName = rootPackageJson.name

    /**
     * Setup namespace for this configuration, depending on the requiring module type
     * @example LOCAL Module:           "my-app|…/scripts/main.js"
     * @example THIRD-PARTY Module:     "my-app|lodash"
     */

    // Format LOCAL Module Namespace (default)
    configuration.namespace = `${rootModuleName}|…/${requiringPackage.filename}`

    // Format THIRD-PARTY Module Namespace
    if (!requiringPackage.isLocalModule) {
        // configuration.namespace = `${rootPackageJson.name}|${requiringPackage.name}`
        configuration.namespace = `${requiringPackage.name}|${requiringPackage.filename}`
    }

    // Attach configuration as property 'configuration' to [loggerInstanceOrFactory]
    // This lets each required instance access its configuration directly
    loggerInstanceOrFactory.configuration = configuration

    // First required Logger instance: Add new header to Logfile
    if (global[loggerPackageJson.name].configurations.size === 1) {
        writeLogfileHeader()
    }

    // Add configuration with filename as key to global[packageName].configurations
    global[loggerPackageJson.name].configurations.set(requiringPackage.path, configuration)

    // This prevents '@sidneys/logger' from being added to the 'require.cache' object after having been required.
    // This enables automatic log message prefixes, depending on from where a logging method was called.
    delete require.cache[__filename]

    // DEBUG
    // module.require('chalkline').red()
    // console.warn('CREATE_LOGGER_INSTANCE()')
    // console.warn('')
    // console.warn('[rootPackagePath]', '\t\t\t' , rootPackagePath)
    // console.warn('[rootPackageJson.name]', '\t\t\t' , rootPackageJson.name)
    // console.warn('[loggerPackageJson.name]', '\t\t' , loggerPackageJson.name)
    // console.warn('[requiringPackage.filename]', '\t\t' , requiringPackage.filename)
    // console.warn('[requiringPackage.name]', '\t\t' , requiringPackage.name)
    // console.warn('[requiringPackage.isLocalModule]', '\t' , requiringPackage.isLocalModule)
    // console.warn('[configuration.namespace]', '\t\t' , configuration.namespace)
    // module.require('chalkline').red()

    // Return
    return loggerInstanceOrFactory
}

// Use factory as baseline for exported object
loggerInstanceOrFactory = createLoggerInstance

// Merge in default logger object properties
Object.assign(loggerInstanceOrFactory, defaultLoggerObject)

// const thisInstance = loggerInstance

/**
 * @module Logger
 */
module.exports = loggerInstanceOrFactory
