import { Provider, Web3Provider } from "@ethersproject/providers"
// @ts-ignore: no-any
import { provider as ganacheProvider } from "ganache-cli"
import configPromise, {
    isGanache,
    isProviderRpcSecure,
    isProviderWebSocketSecure,
    ProviderGanache,
} from "../../config/index"
import logger from "../../utils/logger"
import { LocalJsonRpcProvider } from "./LocalJsonRpcProvider"

let provider: Provider | null = null

const ganache = async (providerConfig: ProviderGanache): Promise<Provider> => {
    logger.warn("Warning: Using Ganache")

    const config = await configPromise
    if (!config?.chain?.provider) {
        throw Error(`Failed to load config for chain.provider`)
    }
    provider = new Web3Provider(ganacheProvider(config.chain.provider))
    return provider
}

const factory = async (): Promise<Provider> => {
    if (provider) {
        return provider
    }
    const config = await configPromise
    if (!config?.chain?.provider) {
        throw Error(`Failed to load config for chain.provider`)
    }
    if (isGanache(config.chain.provider)) {
        return ganache(config.chain.provider)
    }
    return new LocalJsonRpcProvider(config)
}

export default factory
