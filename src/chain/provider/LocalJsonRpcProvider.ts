import { JsonRpcProvider } from "@ethersproject/providers"
import Axios, { AxiosInstance } from "axios"
import { Config, ProviderRpc } from "../../config/index"
import logger from "../../utils/logger"

export class LocalJsonRpcProvider extends JsonRpcProvider {
    private readonly client: AxiosInstance

    constructor(config: Config) {
        if (!config?.chain?.provider) {
            throw Error(`Failed to load config for chain.provider.`)
        }
        const providerConfig = config.chain.provider as ProviderRpc
        if (!providerConfig.url) {
            throw Error(`Failed to read provider url from config`)
        }

        const network = {
            chainId: config.chain.network?.chainId,
            name: config.chain.network?.name || "unknown",
            ensAddress: config.chain.network?.ensAddress,
        }
        super(providerConfig.url, network)
        this.pollingInterval = config.chain.provider.pollingInterval || 1
        this.client = Axios.create({
            baseURL: providerConfig.url,
        })
    }

    public async send(method: string, params: any): Promise<any> {
        const requestId = this._nextId
        logger.debug(`About to send JSON-RPC request`, {
            method,
            params,
            id: this._nextId,
        })
        const response = await super.send(method, params)
        logger.debug(`JSON RPC response`, {
            method,
            response,
            id: requestId,
        })
        return response
    }
}
