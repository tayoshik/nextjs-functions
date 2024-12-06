const { app } = require('@azure/functions');
const { BlobServiceClient } = require("@azure/storage-blob");

app.http('GetThreadsFunction', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // Azure Storageに接続
            const connectionString = process.env.AzureWebJobsStorage;
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient("threads");

            // コンテナが存在しない場合は作成
            await containerClient.createIfNotExists();

            // すべてのスレッドを取得
            const threads = [];
            for await (const blob of containerClient.listBlobsFlat()) {
                const blobClient = containerClient.getBlobClient(blob.name);
                const downloadResponse = await blobClient.download();
                const content = await streamToBuffer(downloadResponse.readableStreamBody);
                const threadData = JSON.parse(content.toString());
                threads.push({
                    id: blob.name.replace('.json', ''),
                    ...threadData
                });
            }

            // 日付の新しい順にソート
            threads.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            return {
                jsonBody: { threads }
            };

        } catch (error) {
            context.log.error('Error in GetThreadsFunction:', error);
            return {
                status: 500,
                jsonBody: { error: "スレッドの取得中にエラーが発生しました。" }
            };
        }
    }
});

// ストリームをバッファに変換するユーティリティ関数
async function streamToBuffer(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on("data", (data) => {
            chunks.push(data instanceof Buffer ? data : Buffer.from(data));
        });
        readableStream.on("end", () => {
            resolve(Buffer.concat(chunks));
        });
        readableStream.on("error", reject);
    });
}