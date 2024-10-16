import eth from 'k6/x/ethereum';
import exec from 'k6/execution';

// k6 'open' function to read files (works in V8 JavaScript engine)
const accountsFile = open('../config/accounts.json');
const accounts = JSON.parse(accountsFile);

// RPC URL for Ethereum network
const rpcUrl =
  'https://eu.build.onbeam.com/rpc/testnet/66d1e153-1d08-37e8-b805-c2391494d054';

// Define the transfer amount (0.01 ETH, or 0.01 * 1e18 wei)
const transferAmount = Number(0.01 * 1e18);

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

// Function to initialize the client for each VU and send the transaction
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
      `Sending from ${account.address} to ${targetAddress} with nonce ${nonce}`
    );

    // Define the transaction
    const tx = {
      to: targetAddress,
      value: transferAmount, // 0.01 ETH in wei
      // gas_price: retry(() => client.gasPrice()), // Retry fetching gas price
      nonce: nonce, // Use manually managed nonce
      // gas: 10000000000000000000,
      gas_fee_cap: 10000000000000000, // 1 Gwei
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
