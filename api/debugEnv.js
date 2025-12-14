export default function handler(req, res) {
  res.status(200).json({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ? "OK" : "MISSING",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ? "OK" : "MISSING"
  });
}
