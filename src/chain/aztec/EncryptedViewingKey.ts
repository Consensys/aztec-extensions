import { ethers } from "ethers"
import nacl from "tweetnacl"
import tweetNaclUtils from "tweetnacl-util"
import { bytes32, bytesFixed } from "../../utils/regEx"

const NonceLength = 48
const EphemeralPublicKeyLength = 64

export class EncryptedViewingKey {
    protected _viewingKey: string

    constructor(
        readonly nonce: string,
        readonly ephemeralPublicKey: string,
        readonly cipherText: string
    ) {
        if (!nonce.match(bytesFixed(24))) {
            throw Error(
                `Invalid nonce ${nonce}. Must be in hexadecimal format with a 0x prefix and 50 character long (24 bytes).`
            )
        }
        if (!ephemeralPublicKey.match(bytes32)) {
            throw Error(
                `Invalid ephemeral public key ${ephemeralPublicKey}. Must be in hexadecimal format with a 0x prefix and 66 character long (32 bytes).`
            )
        }
    }

    get viewingKey(): string {
        return this._viewingKey
    }

    public decryptUsingHexPrivateKey(receiverPrivateKeyHex: string): string {
        if (!receiverPrivateKeyHex.match(bytes32)) {
            throw Error(
                `Private key must be in hexadecimal format with a 0x prefix and 66 characters (32 bytes)`
            )
        }
        return this.decrypt(ethers.utils.arrayify(receiverPrivateKeyHex))
    }

    public decrypt(receiverPrivateKeyUint8Array: Uint8Array): string {
        // return viewing key if already decrypted
        if (this._viewingKey) {
            return this._viewingKey
        }
        if (
            !(receiverPrivateKeyUint8Array instanceof Uint8Array) ||
            receiverPrivateKeyUint8Array.length !== 32
        ) {
            throw Error(
                `Private key must be in Uint8Array format and length 32`
            )
        }

        let decryptedMessage
        try {
            const nonceUint8Array = ethers.utils.arrayify(this.nonce)
            const ephemeralPublicKeyUint8Array = ethers.utils.arrayify(
                this.ephemeralPublicKey
            )
            const cipherTextUint8Array = ethers.utils.arrayify(this.cipherText)

            decryptedMessage = nacl.box.open(
                cipherTextUint8Array,
                nonceUint8Array,
                ephemeralPublicKeyUint8Array,
                receiverPrivateKeyUint8Array
            )
        } catch (err) {
            throw Error(`Failed to decrypt viewing key: ${err.message}`)
        }

        if (!decryptedMessage) {
            throw Error(`Failed to decrypt viewing key with private key.`)
        }
        this._viewingKey = "0x" + tweetNaclUtils.encodeUTF8(decryptedMessage)
        return this._viewingKey
    }

    static fromEncryptedKey(encryptedViewingKey: string): EncryptedViewingKey {
        if (!encryptedViewingKey.match(bytesFixed(210))) {
            throw Error(
                `Encrypted viewing key must be in hexadecimal format with a 0x prefix and 422 characters (210 bytes)`
            )
        }

        // add 2 to length to include the 0x prefix
        const nonce = encryptedViewingKey.slice(0, NonceLength + 2)
        // need to add the 0x prefix for the remaining fields
        const ephemeralPublicKey = `0x${encryptedViewingKey.slice(
            2 + NonceLength,
            2 + NonceLength + EphemeralPublicKeyLength
        )}`
        // the rest of the data is the cipher text
        const ciphertext = `0x${encryptedViewingKey.slice(
            2 + NonceLength + EphemeralPublicKeyLength
        )}`

        return new EncryptedViewingKey(nonce, ephemeralPublicKey, ciphertext)
    }
}
