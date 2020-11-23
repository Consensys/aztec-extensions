import { Contract, Signer } from "ethers"
import * as dvpHoldableLockableSwapCompilerOutput from "../abis/DVPHoldableLockableSwap.json"
import providerFactory from "../provider/providerFactory"
import { DvpHoldableLockableSwap } from "../types/DvpHoldableLockableSwap"

export const compilerOutput = dvpHoldableLockableSwapCompilerOutput

export enum Standard {
    Undefined,
    HoldableERC20,
    HoldableERC1400,
}

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<DvpHoldableLockableSwap> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as DvpHoldableLockableSwap
}
