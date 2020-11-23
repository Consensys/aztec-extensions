import { Signer } from "ethers"
import config from "../../config/index"
import { WalletSigner } from "./WalletSigner"

const signerFactory = async (): Promise<Signer> => {
    const { chain } = await config

    if (!chain?.wallet?.privateKey) {
        throw Error("Failed to load the config for chain.wallet.privateKey")
    }

    return WalletSigner.create(chain.wallet)
}

export default signerFactory
