import { Contract, Signer } from "ethers"
import * as dvpHoldableLockableSwapCompilerOutput from "../abis/DVPHoldableLockableSwap.json"
import providerFactory from "../provider/providerFactory"
import { DVPHoldableLockableSwap } from "../types"

export const compilerOutput = dvpHoldableLockableSwapCompilerOutput

export enum Standard {
    Undefined,
    HoldableERC20,
    HoldableERC1400,
}

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<DVPHoldableLockableSwap> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as DVPHoldableLockableSwap
}
