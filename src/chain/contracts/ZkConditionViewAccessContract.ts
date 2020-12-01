import { Contract, Signer } from "ethers"
import * as ZkConditionViewAccessOutput from "../abis/ZkConditionViewAccess.json"
import providerFactory from "../provider/providerFactory"
import { ZkConditionViewAccess } from "../types"

export const compilerOutput = ZkConditionViewAccessOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<ZkConditionViewAccess> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as ZkConditionViewAccess
}
