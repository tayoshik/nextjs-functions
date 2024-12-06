const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

// Blob Storage の接続文字列
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
app.http('getThreads', {
    methods: ['GET'], // GET メソッドを処理
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            context.log(`[DEBUG] Request method: ${request.method}`);

            // Blobサービスクライアントの作成
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient('threads');

            // コンテナ内のすべての Blob を取得
            const threads = [];
            for await (const blob of containerClient.listBlobsFlat()) {
                const blobClient = containerClient.getBlockBlobClient(blob.name);

                // Blob の内容を取得
                const downloadResponse = await blobClient.download();
                const threadData = await streamToString(downloadResponse.readableStreamBody);
                const thread = JSON.parse(threadData);

                threads.push({
                    id: blob.name.replace('.json', ''),
                    ...thread,
                });
            }

            context.log(`[DEBUG] Retrieved threads: ${threads.length} items`);
            return {
                status: 200,
                jsonBody: {
                    message: 'Threads Retrieved Successfully',
                    threads,
                },
            };
        } catch (error) {
            context.log.error(`[ERROR] Failed to process request:`, error);
            return {
                status: 500,
                jsonBody: {
                    message: 'Internal Server Error',
                    error: error.message,
                },
            };
        }
    },
});

// StreamをStringに変換するユーティリティ関数
async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (data) => {
            chunks.push(Buffer.from(data));
        });
        readableStream.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        readableStream.on('error', reject);
    });
}
