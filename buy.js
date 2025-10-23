import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "https://esm.sh/@solana/spl-token@0.3.5";

const masqMintAddress = '8rup3TJ1mTw3NHui77BFfoG4WoD1PXaijxnFqzh2pump';
const treasuryPublicKey = new solanaWeb3.PublicKey('2Lpgue8SddVbeuiit25Eb9B76V1TNTDmdGnDCMVMBBq6');

let heliusUrl = "";
let provider = null;
let userPublicKey = null;
let supabase = null;

async function initSupabase() {
  if (!supabase) {
    const response = await fetch('/api/supabaseKeys');
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await response.json();
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm");
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

async function getHeliusUrl() {
  showLoadingSpinner(true);
  try {
    const response = await fetch('/api/helius-key');
    const { heliusKey } = await response.json();
    heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  } catch (err) {
    console.error("Error fetching Helius key:", err);
    alert("Could not initialize wallet connection. Please try again later.");
  } finally {
    showLoadingSpinner(false);
  }
}

function showLoadingSpinner(show = true) {
  document.getElementById('loadingSpinner').style.display = show ? 'block' : 'none';
}

await getHeliusUrl();
await initSupabase();

document.getElementById('connectWalletBtn').onclick = async () => {
  showLoadingSpinner(true);
  if ('solana' in window) {
    provider = window.solana;
    try {
      const resp = await provider.connect();
      userPublicKey = resp.publicKey;
      document.getElementById('status').textContent = `Connected Wallet: ${userPublicKey.toBase58()}`;

      // Change button label to "Refresh Stats"
      const connectBtn = document.getElementById('connectWalletBtn');
      connectBtn.textContent = 'Refresh Stats';

      // Change the button's onclick behavior to refreshStats
      connectBtn.onclick = async () => {
        await refreshStats();
      };

      // Immediately call refreshStats after wallet connect
      await refreshStats();

      const connection = new solanaWeb3.Connection(heliusUrl);
      const masqMint = new solanaWeb3.PublicKey(masqMintAddress);
      
      const tokenAccounts = await connection.getTokenAccountsByOwner(userPublicKey, { mint: masqMint });
      let balance = 0;
      if (tokenAccounts.value.length > 0) {
        const tokenAccountPubkey = tokenAccounts.value[0].pubkey;
        const tokenAccountInfo = await connection.getParsedAccountInfo(tokenAccountPubkey);
        balance = tokenAccountInfo.value.data.parsed.info.tokenAmount.uiAmount;
      }

      document.getElementById('status').style.display = 'block';
      document.getElementById('userInfo').style.display = 'block';
      document.getElementById('balance').style.display = 'block';
      document.getElementById('ownedSets').style.display = 'block';
      
      document.getElementById('balance').textContent = `$MASQ Balance: ${balance}`;
      if (balance >= 1_000) {
        document.getElementById('buyPackBtn').style.display = 'inline-block';
      }

      const { data: user, error: userError } = await supabase.auth.getUser();
      if (userError || !user?.user) {
        document.getElementById('ownedSets').textContent = 'Sets owned: Guest mode';
        return;
      }

      const userId = user.user.id;
      const { data: profile } = await supabase.from('users').select('username, owned_sets, wallet').eq('id', userId).single();
      const ownedSets = profile?.owned_sets || [];
      const username = profile?.username || 'Not set';
      const linkedWallet = profile?.wallet || 'None linked';

      const setNames = ownedSets.map(setId => setId === 1 ? "Default Set" : setId === 2 ? "Golden Set" : `Set #${setId}`);
      document.getElementById('ownedSets').textContent = `Sets owned: ${setNames.join(', ') || 'None'}`;
      document.getElementById('userInfo').innerHTML = `
        <p><strong>Username:</strong> ${username}</p>
        <p><strong>Linked Wallet:</strong> ${linkedWallet}</p>
      `;
    } catch (err) {
      console.error("Error connecting to wallet:", err);
      alert('Failed to connect wallet.');
    } finally {
      showLoadingSpinner(false);
    }
  } else {
    alert('Phantom wallet not found. Please install it.');
  }
};

document.getElementById('buyPackBtn').onclick = async () => {
  showLoadingSpinner(true);

  if (!provider || !userPublicKey) {
    alert('Please connect your wallet first!');
    showLoadingSpinner(false);
    return;
  }

  const connection = new solanaWeb3.Connection(heliusUrl);
  const masqMint = new solanaWeb3.PublicKey(masqMintAddress);
  const { data: user, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.user) {
    console.warn('User not authenticated:', userError);
    alert('User not authenticated.');
    showLoadingSpinner(false);
    return;
  }

  const userId = user.user.id;
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('owned_sets, wallet')
    .eq('id', userId)
    .single();

  if (profileError) {
    console.error('Failed to fetch user profile:', profileError);
    alert('Failed to fetch user data.');
    showLoadingSpinner(false);
    return;
  }

  const ownedSets = Array.isArray(profile?.owned_sets) ? profile.owned_sets : [];
  const walletInDB = profile?.wallet;
  const connectedWallet = userPublicKey.toBase58();

  if (walletInDB && walletInDB !== connectedWallet) {
    alert('This wallet does not match your linked wallet. Contact support.');
    showLoadingSpinner(false);
    return;
  }

  console.log('Setting up transaction...');
  const userTokenAccount = await getAssociatedTokenAddress(masqMint, userPublicKey, false);
  const treasuryTokenAccount = await getAssociatedTokenAddress(masqMint, treasuryPublicKey, true);

  const instructions = [];
  const userATAInfo = await connection.getAccountInfo(userTokenAccount);
  if (!userATAInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        userPublicKey, userTokenAccount, userPublicKey, masqMint,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  const treasuryATAInfo = await connection.getAccountInfo(treasuryTokenAccount);
  if (!treasuryATAInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        userPublicKey, treasuryTokenAccount, treasuryPublicKey, masqMint,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  console.log('Adding transfer instruction...');
  const amountToTransfer = 1000000000_000; // 1M tokens
  instructions.push(
    createTransferInstruction(
      userTokenAccount, treasuryTokenAccount, userPublicKey, amountToTransfer, [],
      TOKEN_PROGRAM_ID
    )
  );

  const transaction = new solanaWeb3.Transaction().add(...instructions);
  transaction.feePayer = userPublicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  try {
    console.log('Signing transaction...');
    const signedTx = await provider.signTransaction(transaction);
    console.log('Sending transaction...');
    const signature = await connection.sendRawTransaction(signedTx.serialize());
    console.log('Confirming transaction...');
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    console.log('Transaction confirmation:', confirmation);

    if (confirmation.value.err) {
      throw new Error('Transaction failed to confirm');
    }

    console.log('Transaction confirmed! Updating owned_sets...');
    const { data: updatedProfile, error: fetchAfterTxError } = await supabase
      .from('users')
      .select('owned_sets')
      .eq('id', userId)
      .single();

    if (fetchAfterTxError) {
      console.error('Error re-fetching profile:', fetchAfterTxError);
      alert('Purchase done, but failed to fetch updated profile.');
      showLoadingSpinner(false);
      return;
    }

    let newOwnedSets = updatedProfile.owned_sets || [];

    if (!newOwnedSets.includes(2)) {
      newOwnedSets.push(2);
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ owned_sets: newOwnedSets })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to update owned_sets:', updateError);
      alert('Transaction succeeded, but failed to update owned sets.');
    } else {
      console.log('Successfully updated owned_sets in DB!');
      // alert(`Pack purchased and sets updated! Tx: ${signature}`);
      document.getElementById('ownedSets').textContent = `Sets owned: ${
        newOwnedSets.map(setId => (setId === 1 ? 'Default Set' : setId === 2 ? 'Golden Set' : `Set #${setId}`)).join(', ') || 'None'
      }`;
      // Additional step: update wallet if it's empty
    if (!profile.wallet) {
      console.log('No wallet set. Updating wallet field in Supabase...');
      const { error: updateWalletError } = await supabase
        .from('users')
        .update({ wallet: connectedWallet })
        .eq('id', userId);
  
      if (updateWalletError) {
        console.error('Failed to update wallet field:', updateWalletError);
        alert('Sets updated, but failed to update wallet address. Check if wallet is already linked with another account.');
      } else {
        console.log('Successfully updated wallet field in DB!');
      }
    }
  
    alert(`Pack purchased and sets updated! Tx: ${signature}`);
        
    }
  } catch (err) {
    console.error('Transaction error:', err);
    alert(`Transaction failed: ${err.message || 'Check console for logs.'}`);
  } finally {
    showLoadingSpinner(false);
  }
};

async function refreshStats() {
  showLoadingSpinner(true);
  try {
    const connection = new solanaWeb3.Connection(heliusUrl);
    const masqMint = new solanaWeb3.PublicKey(masqMintAddress);

    const tokenAccounts = await connection.getTokenAccountsByOwner(userPublicKey, { mint: masqMint });
    let balance = 0;
    if (tokenAccounts.value.length > 0) {
      const tokenAccountPubkey = tokenAccounts.value[0].pubkey;
      const tokenAccountInfo = await connection.getParsedAccountInfo(tokenAccountPubkey);
      balance = tokenAccountInfo.value.data.parsed.info.tokenAmount.uiAmount;
    }
    document.getElementById('balance').textContent = `$MASQ Balance: ${balance}`;
    if (balance >= 1_000) {
      document.getElementById('buyPackBtn').style.display = 'inline-block';
    }

    const { data: user, error: userError } = await supabase.auth.getUser();
    if (userError || !user?.user) {
      document.getElementById('ownedSets').textContent = 'Sets owned: Guest mode';
      return;
    }

    const userId = user.user.id;
    const { data: profile } = await supabase.from('users').select('username, owned_sets, wallet').eq('id', userId).single();
    const ownedSets = profile?.owned_sets || [];
    const username = profile?.username || 'Not set';
    const linkedWallet = profile?.wallet || 'None linked';

    const setNames = ownedSets.map(setId => setId === 1 ? "Default Set" : setId === 2 ? "Golden Set" : `Set #${setId}`);
    document.getElementById('ownedSets').textContent = `Sets owned: ${setNames.join(', ') || 'None'}`;
    document.getElementById('userInfo').innerHTML = `
      <p><strong>Username:</strong> ${username}</p>
      <p><strong>Linked Wallet:</strong> ${linkedWallet}</p>
    `;
  } catch (err) {
    console.error("Error refreshing stats:", err);
    alert('Failed to refresh stats.');
  } finally {
    showLoadingSpinner(false);
  }
}


