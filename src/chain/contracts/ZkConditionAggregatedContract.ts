import { Contract, Signer } from "ethers"
import * as ZkConditionApprovedAccountsOutput from "../abis/ZkConditionAggregated.json"
import providerFactory from "../provider/providerFactory"
import { ZkConditionAggregated } from "../types"

export const compilerOutput = ZkConditionApprovedAccountsOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<ZkConditionAggregated> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as ZkConditionAggregated
}
