exports.getRuddrApiKey = (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const sharedSecret = process.env.SHARED_SECRET;
  const ruddrApiKey = process.env.RUDDR_API_KEY;

  const auth = req.headers['authorization'];
  if (!auth || auth !== `Bearer ${sharedSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.status(200).json({ key: ruddrApiKey });
};
