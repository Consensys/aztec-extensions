import { Deferrable, resolveProperties } from "@ethersproject/properties"
import {
    Provider,
    TransactionRequest,
    TransactionResponse,
} from "@ethersproject/providers"
import { randomBytes } from "@ethersproject/random"
import { parseBytes32String } from "@ethersproject/strings"
import { Signer, Wallet } from "ethers"
import logger from "../../utils/logger"
import providerFactory from "../provider/providerFactory"
import { getReasonCode } from "../utils/reasonCodeParsers"
import { TransactionFailedError } from "../utils/TransactionFailedError"

interface WalletSignerOptions {
    // If undefined a random private key will be generated.
    privateKey?: string
    chainId?: number
    // only enable if one process is signing transaction.
    // If true, after the nonce is initially set with getTransactionCount, the nonce will be incremented in memory for each transaction.
    // If false, getTransactionCount is called before each transaction to set the nonce.
    nonceInMemory?: boolean
    // the default price for each transaction. If not set, gasPrice will be called before each transaction.
    gasPrice?: string
    // the default gas limit. If not set, estimateGas will be called before each transaction to set the gas limit.
    gasLimit?: string
    provider?: Provider
}

export class WalletSigner extends Wallet {
    chainId: number
    nonceInMemory: boolean
    gasPrice: string
    gasLimit: string

    static readonly nonceCache: {
        [fromAddress: string]: number
    } = {}

    public static async create(options?: WalletSignerOptions): Promise<Signer> {
        const provider = options?.provider
            ? options?.provider
            : await providerFactory()
        const privateKey =
            options?.privateKey || parseBytes32String(randomBytes(32))
        const newWallet = new WalletSigner(privateKey, provider)
        delete options.privateKey
        Object.assign(newWallet, {
            chainId: options.chainId,
            nonceInMemory: options.nonceInMemory,
            gasPrice: options.gasPrice,
            gasLimit: options.gasLimit,
        })
        return newWallet
    }

    public async sendTransaction(
        transaction: TransactionRequest
    ): Promise<TransactionResponse> {
        logger.debug(`Transaction to be sent`, transaction)
        const tx = await super.sendTransaction(transaction)
        return {
            ...tx,
            wait: async (confirmations?: number) => {
                const receipt = await this.provider.waitForTransaction(tx.hash!)
                if (receipt.status === 0) {
                    const reasonCode = await getReasonCode(
                        receipt,
                        this.provider
                    )
                    throw new TransactionFailedError(tx, receipt, reasonCode)
                }
                return receipt
            },
        }
    }

    async populateTransaction(
        transaction: Deferrable<TransactionRequest>
    ): Promise<TransactionRequest> {
        const tx: Deferrable<TransactionRequest> = await resolveProperties(
            this.checkTransaction(transaction)
        )
        if (tx.gasPrice == null && this.gasPrice) {
            tx.gasPrice = this.gasPrice
        }
        if (
            tx.nonce == null &&
            this.nonceInMemory &&
            typeof tx.from === "string"
        ) {
            if (!WalletSigner.nonceCache[tx.from]) {
                WalletSigner.nonceCache[
                    tx.from
                ] = await this.getTransactionCount("pending")
            }
            tx.nonce = WalletSigner.nonceCache[tx.from]++
        }
        if (tx.gasLimit == null && this.gasLimit) {
            tx.gasLimit = this.gasLimit
        }
        if (tx.chainId == null && this.chainId) {
            tx.chainId = this.chainId
        }
        return await resolveProperties(tx)
    }
}
