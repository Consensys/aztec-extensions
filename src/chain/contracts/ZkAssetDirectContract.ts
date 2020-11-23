import { Contract, Signer } from "ethers"
import * as zkAssetDirectCompilerOutput from "../abis/ZkAssetDirect.json"
import providerFactory from "../provider/providerFactory"
import { ZkAssetDirect } from "../types/ZkAssetDirect"

export const compilerOutput = zkAssetDirectCompilerOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<ZkAssetDirect> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as ZkAssetDirect
}
