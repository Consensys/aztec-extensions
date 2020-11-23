import { compilerOutput } from "../contracts/ZkAssetContract"
import { ZkAsset } from "../types/ZkAsset"
import { Migrator } from "./migrator"

// Deploys a zero-knowledge asset
export default async (
    migrator: Migrator,
    aceContractAddress: string,
    linkedTokenAddress: string,
    scalingFactor: number = 1
): Promise<ZkAsset> => {
    return await migrator.deploy<ZkAsset>(
        compilerOutput,
        aceContractAddress,
        linkedTokenAddress,
        scalingFactor
    )
}
