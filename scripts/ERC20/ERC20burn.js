import eth from 'k6/x/ethereum';
import exec from 'k6/execution';

// k6 'open' function to read files (works in V8 JavaScript engine)
const accountsFile = open('../../config/accounts.json');
const accounts = JSON.parse(accountsFile);
const erc20Address = "0x454F44a8Ca01A9f9Acf105a93d3eA8444714f316"
const erc20abi = open("../contracts/erc20.abi");


// RPC URL for Ethereum network
const rpcUrl =
  `https://eu.build.onbeam.com/rpc/testnet/${__ENV.BEAM_API_KEY}`;


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
  const targetAddress = getRandomTargetAddress(); 

  // Initialize and store the nonce for the current VU if not already set
  if (!nonces[exec.vu.idInTest]) {
    nonces[exec.vu.idInTest] = retry(() => client.getNonce(account.address));
  }

  let nonce = nonces[exec.vu.idInTest];
  try {

    console.log(
      `Burning tokens with nonce ${nonce}`
    );

    const con = client.newContract(erc20Address, erc20abi);
    const txOpt = {
        value: 0, 
        gas_price: client.gasPrice(), 
        nonce: nonce, 
        gas_limit: 60578, // you can increase it if you want
        gas_fee_cap: 1000000000000,
      };


    const tx_burn = con.txn("burn",txOpt,1);
    console.log(`txn hash (burn) => ${tx_burn}`);

    // Increment the nonce for the next transaction
    nonce++;

    // Update the nonce store
    nonces[exec.vu.idInTest] = nonce;
  } catch (err) {
    console.error(`Transaction failed for ${account.address}: ${err}`);
  }
}
