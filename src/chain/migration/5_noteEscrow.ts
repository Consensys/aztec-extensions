import { compilerOutput } from "../contracts/NoteEscrowContract"
import { NoteEscrow } from "../types"
import { Migrator } from "./migrator"

// Deploys Simple Note Escrow contract
export default async (
    migrator: Migrator,
    assetContractAddress: string
): Promise<NoteEscrow> => {
    return await migrator.deploy<NoteEscrow>(
        compilerOutput,
        assetContractAddress
    )
}
