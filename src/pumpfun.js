import axios from 'axios';
import FormData from 'form-data';
import { VersionedTransaction, Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.PUMP_PRIVATE_KEY) throw new Error("Missing PUMP_PRIVATE_KEY");
if (!process.env.SOLANA_RPC_URL) throw new Error("Missing SOLANA_RPC_URL");

const RPC_ENDPOINT = process.env.SOLANA_RPC_URL;
const web3Connection = new Connection(RPC_ENDPOINT, 'confirmed');
const signerKeyPair = Keypair.fromSecretKey(bs58.decode(process.env.PUMP_PRIVATE_KEY));

async function uploadToIPFS(imageBuffer, name, symbol, description, website) {
    const formData = new FormData();
    formData.append('file', Buffer.from(imageBuffer, 'base64'), 'screenshot.png');
    formData.append('name', name);
    formData.append('symbol', symbol);
    formData.append('description', description);
    formData.append('website', website);
    formData.append('showName', 'true');

    const response = await axios.post('https://pump.fun/api/ipfs', formData, {
        headers: formData.getHeaders()
    });
    return response.data;
}

async function createToken(name, ticker, imageBuffer, instagramPostUrl) {
    try {
       
        const description = `Token created via Instagram mention`;
        const ipfsData = await uploadToIPFS(imageBuffer, name, ticker, description, instagramPostUrl);
        const metadata = ipfsData.metadata;
        const metadataUri = ipfsData.metadataUri;
        console.log('Uploaded metadata URI:', metadataUri);

        
        const mintKeypair = Keypair.generate();

        
        const txResponse = await axios.post(
            'https://pumpportal.fun/api/trade-local',
            {
                publicKey: signerKeyPair.publicKey.toBase58(),
                action: 'create',
                tokenMetadata: {
                    name: metadata.name,
                    symbol: metadata.symbol,
                    uri: metadataUri
                },
                mint: mintKeypair.publicKey.toBase58(),
                denominatedInSol: 'true',
                amount: 0, 
                slippage: 10,
                priorityFee: 0.00001,
                pool: 'pump'
            },
            { responseType: 'arraybuffer', headers: { 'Content-Type': 'application/json' } }
        );

        
        const tx = VersionedTransaction.deserialize(new Uint8Array(txResponse.data));
        tx.sign([mintKeypair, signerKeyPair]);
        const signature = await web3Connection.sendTransaction(tx);
        console.log('Transaction Signature:', signature);
        await web3Connection.confirmTransaction({ signature, strategy: 'confirmed' });

        return {
            success: true,
            signature,
            mintAddress: mintKeypair.publicKey.toBase58(),
            pumpFunLink: `https://pump.fun/token/${mintKeypair.publicKey.toBase58()}`
        };
    } catch (error) {
        console.error('Error creating token:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

export { createToken };
