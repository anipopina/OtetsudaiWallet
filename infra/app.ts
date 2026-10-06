import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import {HttpLambdaIntegration} from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import {resolve} from 'node:path';
class WalletStack extends cdk.Stack{
 constructor(scope:Construct,id:string,props:cdk.StackProps){super(scope,id,props);
 const table=new dynamodb.Table(this,'Ledger',{partitionKey:{name:'pk',type:dynamodb.AttributeType.STRING},sortKey:{name:'sk',type:dynamodb.AttributeType.STRING},billingMode:dynamodb.BillingMode.PAY_PER_REQUEST,pointInTimeRecoverySpecification:{pointInTimeRecoveryEnabled:true},removalPolicy:cdk.RemovalPolicy.RETAIN});
 const fn=new NodejsFunction(this,'ApiHandler',{entry:resolve('server/handler.ts'),runtime:lambda.Runtime.NODEJS_22_X,environment:{TABLE_NAME:table.tableName},timeout:cdk.Duration.seconds(15),memorySize:256,bundling:{externalModules:[],minify:true},logGroup:new logs.LogGroup(this,'ApiLogs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:cdk.RemovalPolicy.DESTROY})});table.grantReadWriteData(fn);
 const api=new apigateway.HttpApi(this,'Api',{defaultIntegration:new HttpLambdaIntegration('Lambda',fn)});
 const stage=api.defaultStage!.node.defaultChild as apigateway.CfnStage;stage.defaultRouteSettings={throttlingBurstLimit:20,throttlingRateLimit:10};
 const bucket=new s3.Bucket(this,'Frontend',{blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,enforceSSL:true,encryption:s3.BucketEncryption.S3_MANAGED,removalPolicy:cdk.RemovalPolicy.RETAIN});
 const headers=new cloudfront.ResponseHeadersPolicy(this,'Headers',{securityHeadersBehavior:{referrerPolicy:{referrerPolicy:cloudfront.HeadersReferrerPolicy.NO_REFERRER,override:true},contentTypeOptions:{override:true},frameOptions:{frameOption:cloudfront.HeadersFrameOption.DENY,override:true},strictTransportSecurity:{accessControlMaxAge:cdk.Duration.days(365),includeSubdomains:true,override:true},contentSecurityPolicy:{contentSecurityPolicy:"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",override:true}}});
 const rewrite=new cloudfront.Function(this,'SpaRoutes',{code:cloudfront.FunctionCode.fromInline("function handler(event) { var r=event.request; if(r.uri==='/' || r.uri==='/bank' || r.uri==='/wallet') { r.uri='/index.html'; r.querystring={}; } return r; }")});
 const certificateArn=this.node.tryGetContext('certificateArn');const domainName=this.node.tryGetContext('domainName')??'otetsudai-wallet.anipopina.com';
 const distribution=new cloudfront.Distribution(this,'Distribution',{...(certificateArn?{domainNames:[domainName],certificate:acm.Certificate.fromCertificateArn(this,'Certificate',certificateArn)}:{}),defaultBehavior:{origin:origins.S3BucketOrigin.withOriginAccessControl(bucket),viewerProtocolPolicy:cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,responseHeadersPolicy:headers,functionAssociations:[{function:rewrite,eventType:cloudfront.FunctionEventType.VIEWER_REQUEST}]},additionalBehaviors:{'/api/*':{origin:new origins.HttpOrigin(cdk.Fn.select(2,cdk.Fn.split('/',api.apiEndpoint))),allowedMethods:cloudfront.AllowedMethods.ALLOW_ALL,cachePolicy:cloudfront.CachePolicy.CACHING_DISABLED,originRequestPolicy:cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,viewerProtocolPolicy:cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,responseHeadersPolicy:headers}}});
 new deployment.BucketDeployment(this,'PublishFrontend',{sources:[deployment.Source.asset(resolve('dist'))],destinationBucket:bucket,distribution,distributionPaths:['/*']});
 new cdk.CfnOutput(this,'WebsiteUrl',{value:`https://${distribution.distributionDomainName}`});new cdk.CfnOutput(this,'DistributionDomain',{value:distribution.distributionDomainName});new cdk.CfnOutput(this,'ApiEndpoint',{value:api.apiEndpoint});
 }
}
const app=new cdk.App();new WalletStack(app,'OtetsudaiWallet',{env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION??'ap-northeast-1'},terminationProtection:true});
