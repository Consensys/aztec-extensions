import local from "./local"
import remote from "./remote"

export type Account = {
    secretKey: string
    balance: string
}

export interface ProviderDefaults {
    gasLimit?: string
    gasPrice?: string
    pollingInterval?: number
}

export interface ProviderGanache extends ProviderDefaults {
    accounts: Account[]
}

export interface ProviderRpc extends ProviderDefaults {
    url: string
}

export interface ProviderRpcSecure extends ProviderRpc {
    username: string
    password: string
}

export interface ProviderWebSocket extends ProviderDefaults {
    url: string
}

export interface ProviderWebSocketSecure extends ProviderDefaults {
    url: string
    username: string
    password: string
}
export const isGanache = (
    provider: ProviderGanache | ProviderRpc | ProviderRpcSecure
): provider is ProviderGanache => {
    return (provider as ProviderRpc).url === undefined
}

export const isProviderRpc = (
    provider: ProviderGanache | ProviderRpc | ProviderRpcSecure
): provider is ProviderRpc => {
    return (
        ((provider as ProviderRpcSecure).username === undefined ||
            (provider as ProviderRpcSecure).password === undefined) &&
        (provider as ProviderRpcSecure).url?.startsWith("http://")
    )
}

export const isProviderRpcSecure = (
    provider: ProviderGanache | ProviderRpc | ProviderRpcSecure
): provider is ProviderRpcSecure => {
    return (
        (provider as ProviderRpcSecure).username !== undefined &&
        (provider as ProviderRpcSecure).password !== undefined &&
        (provider as ProviderRpcSecure).url?.startsWith("https://")
    )
}

export const isProviderWebSocketSecure = (
    provider: ProviderGanache | ProviderRpc | ProviderRpcSecure
): provider is ProviderRpcSecure => {
    return (
        (provider as ProviderRpcSecure).username !== undefined &&
        (provider as ProviderRpcSecure).password !== undefined &&
        (provider as ProviderRpcSecure).url?.startsWith("wss://")
    )
}

export type Config = {
    chain: {
        timestampPrecision: number
        network: {
            chainId: number
            name?: string
            ensAddress?: string
        }
        provider?: ProviderGanache | ProviderRpc | ProviderRpcSecure
        wallet?: {
            privateKey: string
        }
    }
}

const loadConfig = (): Config => {
    const env = process.env.NODE_ENV
    if (!env) {
        // tslint:disable-next-line: no-console
        console.error(
            `NODE_ENV environment variable must be set to "local" or "prod", not ${env}`
        )
    }
    // tslint:disable-next-line: no-console
    console.log(`Environment: ${env}`)
    switch (env) {
        case "remote":
            return remote
        default:
            return local
    }
}

const config = loadConfig()

export default config
