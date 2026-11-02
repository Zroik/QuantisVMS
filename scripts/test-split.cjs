async function main() {
  const authRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'AdminPass123!' }),
  });
  const authData = await authRes.json();
  const token = authData.accessToken || authData.token;
  console.log('Logged in. Token present:', !!token);

  // Split Camera 2 into 2 sensors
  const splitRes = await fetch('http://localhost:3000/api/cameras/2/split', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ split_count: 2 })
  });
  console.log('splitRes status:', splitRes.status);
  const splitData = await splitRes.json();
  console.log('Split API response:', JSON.stringify(splitData, null, 2));

  // Get all cameras
  const camsRes = await fetch('http://localhost:3000/api/cameras', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const cams = await camsRes.json();
  console.log('All cameras count:', cams.length);
  cams.forEach(c => {
    console.log(`- ID: ${c.id}, Name: "${c.name}", Split: ${c.split_count}, Slice: ${c.slice_index}, Parent: ${c.parent_camera_id}, StreamPath: ${c.stream_path}`);
  });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
