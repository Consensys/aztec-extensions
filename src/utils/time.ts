export const nowSeconds = () => Math.floor(Date.now() / 1000)
export const nowMilliseconds = () => Date.now()

export const epochSeconds = (date: Date): number =>
    Math.floor(date.getTime() / 1000)

export const sleep = async (milliseconds: number) => {
    await new Promise(r => setTimeout(r, milliseconds))
}

export const addDays = (date: Date, days: number) => {
    const result = new Date(date)
    result.setDate(result.getDate() + days)
    return result
}
