import crypto from "crypto"

// Format required for sending bytes through eth client:
//  - hex string representation
//  - prefixed with 0x
export const bufferToString = b => "0x" + b.toString("hex")

export const sha256 = x => crypto.createHash("sha256").update(x).digest()

export const random32 = () => crypto.randomBytes(32)

export const isSha256Hash = hashStr => /^0x[0-9a-f]{64}$/i.test(hashStr)

export const newSecretHashPair = () => {
    const secret = random32()
    const hash = sha256(secret)
    return {
        secret: bufferToString(secret),
        hash: bufferToString(hash),
    }
}
