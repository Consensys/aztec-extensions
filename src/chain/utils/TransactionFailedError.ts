import {
    TransactionReceipt,
    TransactionResponse,
} from "@ethersproject/providers"

export const isTransactionFailedError = (
    // tslint:disable-next-line:no-any
    err: any
): err is TransactionFailedError => {
    return err && typeof err.getReasonCode === "function"
}

export class TransactionFailedError extends Error {
    public readonly transaction: TransactionResponse
    public readonly receipt: TransactionReceipt
    public readonly reasonCode: string

    public constructor(
        transaction: TransactionResponse,
        receipt: TransactionReceipt,
        reasonCode: string
    ) {
        super(`revert ${reasonCode}`)
        this.transaction = transaction
        this.receipt = receipt
        this.reasonCode = reasonCode
    }
}
