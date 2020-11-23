export const getResult = (payload: {
    // tslint:disable-next-line: no-any
    error?: { code?: number; data?: any; message?: string }
    // tslint:disable-next-line: no-any
    result?: any
    // tslint:disable-next-line: no-any
}): any => {
    if (payload.error) {
        // tslint:disable-next-line: no-any
        const error: any = new Error(payload.error.message)
        error.code = payload.error.code
        error.response = payload.error.data
        throw error
    }

    return payload.result
}
