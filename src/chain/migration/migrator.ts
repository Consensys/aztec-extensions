import { Contract, Signer } from "ethers"
import logger from "../../utils/logger"
import { deploy } from "../deploy"
import signerFactory from "../wallet/signerFactory"

export class Migrator {
    public readonly signer: Signer

    constructor(signer: Signer) {
        this.signer = signer
    }

    public async deploy<T extends Contract>(
        compilerOutput: unknown,
        ...args: unknown[]
    ): Promise<T> {
        logger.debug(`Deploying contract with args ${JSON.stringify(args)}`)
        const contract = await deploy<T>(this.signer, compilerOutput, ...args)
        logger.debug(
            `Deployed to ${
                contract.address
            } using signer ${await this.signer.getAddress()}`
        )
        return contract
    }
}

const migratorFactory = async (signerOverride?: Signer): Promise<Migrator> => {
    const signer = signerOverride ? signerOverride : await signerFactory()
    return new Migrator(signer)
}

export default migratorFactory
