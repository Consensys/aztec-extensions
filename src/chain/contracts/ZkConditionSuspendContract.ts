import { Contract, Signer } from "ethers"
import * as ZkAssetViewAccessOutput from "../abis/ZkConditionSuspend.json"
import providerFactory from "../provider/providerFactory"
import { ZkConditionSuspend } from "../types"

export const compilerOutput = ZkAssetViewAccessOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<ZkConditionSuspend> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as ZkConditionSuspend
}
