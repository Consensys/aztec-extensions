import * as winston from "winston"

const consoleTransport = new winston.transports.Console({
    format: winston.format.prettyPrint({
        colorize: true,
    }),
})

export const winstonInstance = winston.createLogger({
    level: "debug",
    format: winston.format.json(),
    transports: [consoleTransport],
})

// tslint:disable-next-line: no-any
const debug = (message: string, meta?: any) => {
    winstonInstance.debug(message, meta)
}

// tslint:disable-next-line: no-any
const info = (message: string, meta?: any) => {
    winstonInstance.info(message, meta)
}

// tslint:disable-next-line: no-any
const warn = (message: string, meta?: any) => {
    winstonInstance.warn(message, meta)
}

// tslint:disable-next-line: no-any
const error = (message: string, meta?: any) => {
    winstonInstance.error(message, meta)
}

export default {
    debug,
    info,
    warn,
    error,
}
