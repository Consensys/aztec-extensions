import { compilerOutput } from "../contracts/ZkAssetConditionalContract"
import { ZkAssetConditional } from "../types"
import { Migrator } from "./migrator"

// Deploys a zero-knowledge asset
export default async (
    migrator: Migrator,
    aceContractAddress: string,
    conditionContractAddress: string,
    scalingFactor: number = 1
): Promise<ZkAssetConditional> => {
    return await migrator.deploy<ZkAssetConditional>(
        compilerOutput,
        aceContractAddress,
        scalingFactor,
        conditionContractAddress
    )
}
