import { compilerOutput } from "../contracts/SimpleTokenContract"
import { SimpleToken } from "../types"
import { Migrator } from "./migrator"

// Deploys the simple ERC20 token that is mintable
export default async (migrator: Migrator): Promise<SimpleToken> => {
    return (await migrator.deploy(compilerOutput)) as SimpleToken
}
