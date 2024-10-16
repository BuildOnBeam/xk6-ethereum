import eth from 'k6/x/ethereum';
import exec from 'k6/execution';

// k6 'open' function to read files (works in V8 JavaScript engine)
const accountsFile = open('../config/accounts.json');
const {erc20Address, mintAbi} = open('./contracts/ERC20.js');
const accounts = JSON.parse(accountsFile);

// RPC URL for Ethereum network
const rpcUrl =
  `https://eu.build.onbeam.com/rpc/testnet/${__ENV.BEAM_API_KEY}`;

// ERC-20 contract address and ABI
const erc20ABI = [
  {
    "constant": false,
    "inputs": [
      { "name": "account", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "mint",
    "outputs": [],
    "type": "function"
  },
];

// Define the amount of tokens to mint (adjust as needed)
const mintAmount = Number(1000 * 1e18); // 1000 tokens, assuming 18 decimals

export const options = {
  scenarios: {
    continuous_transactions: {
      executor: 'constant-vus',
      vus: 100, // 100 virtual users (one per account)
      duration: '10s', // Run for 30 seconds
    },
  },
  setupTimeout: '220s',
};

// Function to remove '0x' prefix from private keys
function stripHexPrefix(hexString) {
  return hexString.startsWith('0x') ? hexString.slice(2) : hexString;
}

let clients = {};
let nonces = {}; // Store nonces per VU

// Utility function to retry a block of code a specified number of times
function retry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return fn();
    } catch (error) {
      console.warn(`Attempt ${i + 1} failed: ${error}`);
      if (i === retries - 1) {
        throw error; // Rethrow after final attempt
      }
    }
  }
}

// Utility function to select a random target address from the accounts file
function getRandomTargetAddress() {
  const randomIndex = Math.floor(Math.random() * accounts.length);
  return accounts[randomIndex].address;
}

// Function to initialize the client for each VU and send the mint transaction
export default function () {
  // Get the account corresponding to the current VU's index
  const account = accounts[exec.vu.idInTest - 1];
  if (!account) {
    console.error(`No account found for VU index ${exec.vu.idInTest}`);
    return;
  }


  // Strip the '0x' prefix from the private key
  const privateKey = stripHexPrefix(account.privateKey);

  // Initialize the client for each VU if it hasn't been created
  if (!clients[exec.vu.idInTest]) {
    clients[exec.vu.idInTest] = new eth.Client({
      url: rpcUrl,
      privateKey: privateKey, // Use each VU's private key without '0x'
    });
  }

  const client = clients[exec.vu.idInTest];

  // Initialize and store the nonce for the current VU if not already set
  if (!nonces[exec.vu.idInTest]) {
    nonces[exec.vu.idInTest] = retry(() => client.getNonce(account.address));
  }

  let nonce = nonces[exec.vu.idInTest];
  const targetAddress = getRandomTargetAddress(); // Get a random target address from the list

  try {

    console.log(
      `Minting tokens to ${targetAddress} with nonce ${nonce}`
    );

    

    // Encode the mint function call with parameters (address, amount)
    const encodedData = client.encodeFunctionCall(mintAbi, [targetAddress, mintAmount]);

    // Define the transaction for minting tokens
    const tx = {
      to: erc20Address,
      data: encodedData, // ABI encoded data for the mint function
      nonce: nonce,
      gas_fee_cap: 1000000000000, // 1 Gwei
      gas: 100000, // Adjust gas limit as needed
    };

    // Send the transaction
    const txHash = retry(() => client.sendRawTransaction(tx));
    console.log(`Transaction hash: ${txHash}`);

    // Increment the nonce for the next transaction
    nonce++;

    // Update the nonce store
    nonces[exec.vu.idInTest] = nonce;
  } catch (err) {
    console.error(`Transaction failed for ${account.address}: ${err}`);
  }
}
