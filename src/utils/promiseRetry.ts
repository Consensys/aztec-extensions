import * as retry from "retry"

export type RetryableFn<ResolutionType> = (
    retry: (error: Error) => never,
    attempt: number
) => Promise<ResolutionType>

export class RetryError extends Error {
    public readonly code: string
    public readonly retried: Error
    constructor(msg: string, code: string, retried: Error) {
        super(msg)
        this.code = code
        this.retried = retried
    }
}

export const promiseRetry = <ResolutionType>(
    fn: RetryableFn<ResolutionType>,
    options?: retry.OperationOptions
): Promise<ResolutionType> => {
    if (!options) {
        options = {
            retries: 4,
        }
    }
    const operation = retry.operation(options)

    return new Promise((resolve, reject) => {
        operation.attempt(count => {
            Promise.resolve()
                .then(() => {
                    return fn((err: Error) => {
                        if (err instanceof RetryError) {
                            err = err.retried
                        }
                        throw new RetryError("Retrying", "EPROMISERETRY", err)
                    }, count)
                })
                .then(resolve, err => {
                    if (err instanceof RetryError) {
                        err = err.retried

                        if (operation.retry(err || new Error())) {
                            return
                        }
                    }

                    reject(err)
                })
        })
    })
}
