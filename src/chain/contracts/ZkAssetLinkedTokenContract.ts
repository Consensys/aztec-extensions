import { Contract, Signer } from "ethers"
import * as zkAssetLinkedTokenCompilerOutput from "../abis/ZkAssetLinkedToken.json"
import providerFactory from "../provider/providerFactory"
import { ZkAssetLinkedToken } from "../types"

export const compilerOutput = zkAssetLinkedTokenCompilerOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<ZkAssetLinkedToken> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as ZkAssetLinkedToken
}
