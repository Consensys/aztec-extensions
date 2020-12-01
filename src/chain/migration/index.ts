import { ACE, SimpleToken, ZkAssetMintable } from "../types"
import AceMigration from "./1_ace"
import SimpleTokenMigration from "./2_simpleToken"
import ZkAssetDirectMigration from "./3_zkAssetDirect"
import migratorFactory from "./migrator"

export const migrate = async (): Promise<
    [ACE, SimpleToken, ZkAssetMintable]
> => {
    const migrator = await migratorFactory()

    const aceContract = await AceMigration(migrator)
    const tokenContract = await SimpleTokenMigration(migrator)
    const zkAsset = await ZkAssetDirectMigration(migrator, aceContract.address)

    return [aceContract, tokenContract, zkAsset]
}
