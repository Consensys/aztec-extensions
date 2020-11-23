import { Contract, Signer } from "ethers"
import * as SimpleTokenCompilerOutput from "../abis/SimpleToken.json"
import providerFactory from "../provider/providerFactory"
import { SimpleToken } from "../types/SimpleToken"

export const compilerOutput = SimpleTokenCompilerOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<SimpleToken> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as SimpleToken
}
