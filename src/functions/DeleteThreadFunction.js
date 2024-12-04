const { app } = require('@azure/functions');
const { BlobServiceClient } = require("@azure/storage-blob");

app.http('DeleteThreadFunction', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // リクエストボディを取得
            const { threadId } = await request.json();
            if (!threadId) {
                return {
                    status: 400,
                    jsonBody: { error: "スレッドIDは必須です。" }
                };
            }

            // Azure Storageに接続
            const connectionString = process.env.AzureWebJobsStorage;
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient("threads");
            const blobClient = containerClient.getBlobClient(`${threadId}.json`);

            // スレッドの存在確認
            try {
                await blobClient.getProperties();
            } catch (error) {
                return {
                    status: 404,
                    jsonBody: { error: "指定されたスレッドが見つかりません。" }
                };
            }

            // スレッドを削除
            await blobClient.delete();

            return {
                jsonBody: {
                    message: "スレッドを削除しました",
                    threadId
                }
            };

        } catch (error) {
            context.log.error('Error in DeleteThreadFunction:', error);
            return {
                status: 500,
                jsonBody: { error: "スレッドの削除中にエラーが発生しました。" }
            };
        }
    }
});