// Phusion Passenger (cPanel > "Setup Node.js App") loads this file with require().
// The API itself is an ES module bundle, so load it with a dynamic import.
import('./server.js').catch((error) => {
  console.error('RetailOS API failed to start:', error);
  process.exit(1);
});
