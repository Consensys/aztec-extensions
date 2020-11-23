import { Contract, Signer } from "ethers"
import * as zkAssetDirectCompilerOutput from "../abis/NoteEscrow.json"
import providerFactory from "../provider/providerFactory"
import { NoteEscrow } from "../types/NoteEscrow"

export const compilerOutput = zkAssetDirectCompilerOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<NoteEscrow> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as NoteEscrow
}
