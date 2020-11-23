import { Contract, Signer } from "ethers"
import * as ZkConditionApprovedAccountsOutput from "../abis/ZkConditionApprovedAccounts.json"
import providerFactory from "../provider/providerFactory"
import { ZkConditionApprovedAccounts } from "../types/ZkConditionApprovedAccounts"

export const compilerOutput = ZkConditionApprovedAccountsOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<ZkConditionApprovedAccounts> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as ZkConditionApprovedAccounts
}
