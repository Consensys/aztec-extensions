import { compilerOutput } from "../contracts/ZkAssetDirectContract"
import { ZkAssetDirect } from "../types"
import { Migrator } from "./migrator"

// Deploys a zero-knowledge asset
export default async (
    migrator: Migrator,
    aceContractAddress: string,
    scalingFactor: number = 1
): Promise<ZkAssetDirect> => {
    return await migrator.deploy<ZkAssetDirect>(
        compilerOutput,
        aceContractAddress,
        scalingFactor
    )
}
