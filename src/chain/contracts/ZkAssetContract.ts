import { Contract, Signer } from "ethers"
import * as zkAssetCompilerOutput from "../abis/ZkAsset.json"
import providerFactory from "../provider/providerFactory"
import { ZkAsset } from "../types/ZkAsset"

export const compilerOutput = zkAssetCompilerOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<ZkAsset> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as ZkAsset
}
