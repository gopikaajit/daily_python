import os
print("Hello world")
print("To rename files")
i=1
f1=open("filenames.txt","w")
while(i<=3) :
    filename="file"+str(i)+".txt"
    f=open(filename, "w")
    i+=1
    f1.write(filename+"\n")
f1.close()
# f2=open("filenames.txt","r")
# for x in f2:
#     print(x)
# #print(f2.readlines())
# f2.close()
print("end")