import { Contract, Signer } from "ethers"
import * as holdableTokenCompilerOutput from "../abis/HoldableToken.json"
import providerFactory from "../provider/providerFactory"
import { HoldableToken } from "../types"

export const compilerOutput = holdableTokenCompilerOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<HoldableToken> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as HoldableToken
}
