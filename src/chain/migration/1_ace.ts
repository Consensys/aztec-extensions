import * as bn128 from "@aztec/bn128"
import * as utils from "@aztec/dev-utils"
import * as DividendCompilerOutput from "../abis/Dividend.json"
import * as JoinSplitCompilerOutput from "../abis/JoinSplit.json"
import * as JoinSplitFluidCompilerOutput from "../abis/JoinSplitFluid.json"
import * as PrivateRangeCompilerOutput from "../abis/PrivateRange.json"
import * as SwapCompilerOutput from "../abis/Swap.json"
import { compilerOutput } from "../contracts/AceContract"
import { compilerOutput as FactoryAdjustableCompilerOutput } from "../contracts/FactoryAdjustableContract"
import { compilerOutput as FactoryBaseCompilerOutput } from "../contracts/FactoryBaseContract"
import { ACE, Dividend, JoinSplit, JoinSplitFluid, PrivateRange, Swap } from "../types"
import { Migrator } from "./migrator"

// Deploys the Aztec proof contracts and Aztec Cryptography Engine
// (ACE)
export default async (migrator: Migrator): Promise<ACE> => {
    // Aztec proof contracts
    const dividendContract = await migrator.deploy<Dividend>(
        DividendCompilerOutput
    )
    // Used by mint and burn proofs
    const JoinSplitFluidContract = await migrator.deploy<JoinSplitFluid>(
        JoinSplitFluidCompilerOutput
    )
    const joinSplitContract = await migrator.deploy<JoinSplit>(
        JoinSplitCompilerOutput
    )
    const privateRangeContract = await migrator.deploy<PrivateRange>(
        PrivateRangeCompilerOutput
    )
    const swapContract = await migrator.deploy<Swap>(SwapCompilerOutput)

    // Aztec Cryptography Engine
    const aceContract = await migrator.deploy<ACE>(compilerOutput)
    await aceContract.setCommonReferenceString(bn128.CRS)

    // Set proofs in ACE
    await aceContract.setProof(
        utils.proofs.DIVIDEND_PROOF,
        dividendContract.address
    )
    await aceContract.setProof(
        utils.proofs.JOIN_SPLIT_PROOF,
        joinSplitContract.address
    )
    await aceContract.setProof(
        utils.proofs.MINT_PROOF,
        JoinSplitFluidContract.address
    )
    await aceContract.setProof(
        utils.proofs.BURN_PROOF,
        JoinSplitFluidContract.address
    )
    await aceContract.setProof(
        utils.proofs.PRIVATE_RANGE_PROOF,
        privateRangeContract.address
    )
    await aceContract.setProof(utils.proofs.SWAP_PROOF, swapContract.address)

    // Deploy base and adjustable factories and set in ACE
    const factoryBase = await migrator.deploy(
        FactoryBaseCompilerOutput,
        aceContract.address
    )
    const factoryAdjustable = await migrator.deploy(
        FactoryAdjustableCompilerOutput,
        aceContract.address
    )
    let tx = await aceContract.setFactory(
        1 * 256 ** 2 + 1 * 256 ** 1 + 1 * 256 ** 0,
        factoryBase.address
    )
    await tx.wait()
    tx = await aceContract.setFactory(
        1 * 256 ** 2 + 1 * 256 ** 1 + 2 * 256 ** 0,
        factoryAdjustable.address
    )
    await tx.wait()
    tx = await aceContract.setFactory(
      1 * 256 ** 2 + 1 * 256 ** 1 + 3 * 256 ** 0,
      factoryAdjustable.address
    )
    await tx.wait()

    return aceContract
}
