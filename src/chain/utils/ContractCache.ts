import { Contract, Signer } from "ethers"
import { Interface, ParamType } from "ethers/lib/utils"
import logger from "../../utils/logger"
import providerFactory from "../provider/providerFactory"

// cache of the contract instances
const contractInstances: {
    [ensNameOrAddress: string]: {
        [signerAddress: string]: Contract
    }
} = {}

// Returns an instance of a contract for the signer if it is already cached
// If not cached, it'll instantiate the contract for the signer and save it in the cache for next time
export const getContractInstance = async (
    ensNameOrAddress: string,
    abi: string[] | ParamType[] | string | Interface,
    signer: Signer | null = null
): Promise<Contract> => {
    let signerAddress = "default"
    if (signer !== null) {
        signerAddress = await signer.getAddress()
    }

    // see if the signer instance of the contract is already cached
    if (
        contractInstances[ensNameOrAddress] &&
        contractInstances[ensNameOrAddress][signerAddress]
    ) {
        return contractInstances[ensNameOrAddress][signerAddress]
        // see if a default instance of the contract is already cached so we can connected the signer to it
    } else if (
        contractInstances[ensNameOrAddress] &&
        contractInstances[ensNameOrAddress].default &&
        signer
    ) {
        contractInstances[ensNameOrAddress][signerAddress] = contractInstances[
            ensNameOrAddress
        ].default.connect(signer)
        return contractInstances[ensNameOrAddress][signerAddress]
    }

    // not cached so instantiate the contract
    const provider = await providerFactory()

    logger.info(
        `Cached contract with ENS name or address "${ensNameOrAddress}" and signer address ${signerAddress}.`
    )

    const instance = new Contract(ensNameOrAddress, abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance

    if (!contractInstances[ensNameOrAddress]) {
        contractInstances[ensNameOrAddress] = {}
    }
    contractInstances[ensNameOrAddress][signerAddress] = signerInstance

    return signerInstance
}
